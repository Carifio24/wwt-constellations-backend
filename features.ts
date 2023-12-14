import * as t from "io-ts";
import { isLeft } from "fp-ts/lib/Either.js";
import { PathReporter } from "io-ts/lib/PathReporter.js";
import { Response } from "express";
import { Request as JwtRequest } from "express-jwt";
import { ObjectId, WithId } from "mongodb";

import { State } from "./globals.js";
import { sceneToJson, sceneToPlace } from "./scenes.js";

export interface MongoSceneFeature {
  scene_id: ObjectId; 
  feature_time: Date;
}

export interface MongoSceneFeatureQueue {
  scene_ids: ObjectId[];
}

export interface HydratedSceneFeature {
  id?: ObjectId;
  scene: Record<string, any>;
  feature_time: Date;
}

function timeStrippedDate(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

export async function getFeatureForDate(state: State, date: Date): Promise<WithId<MongoSceneFeature> | null> {
  const day = timeStrippedDate(date);
  const nextDay = new Date(day);
  nextDay.setDate(nextDay.getDate() + 1);

  // We're assuming that there's only one feature!
  return state.features.findOne({
    "$and": [
      { feature_time: { "$gte": day } },
      { feature_time: { "$lt": nextDay } } 
    ]
  });
}

export async function getFeaturesForRange(state: State, startDate: Date, endDate: Date) {
  return state.features.find({
    "$and": [
      { feature_time: { "$gte": startDate } },
      { feature_time: { "$lt": endDate } }
    ]
  });
}

async function hydratedFeature(state: State, feature: WithId<MongoSceneFeature>, req: JwtRequest): Promise<HydratedSceneFeature> {
  const scene = await state.scenes.findOne({ "_id": feature.scene_id });
  if (scene === null) {
    throw new Error(`Database consistency failure, feature ${feature._id} missing scene ${feature.scene_id}`);
  }

  const sceneJson = await sceneToJson(scene, state, req.session);
  return {
    id: feature._id,
    feature_time: feature.feature_time,
    scene: sceneJson
  };
}

export function initializeFeatureEndpoints(state: State) {
  const FeatureCreation = t.type({
    scene_id: t.string,
    feature_time: t.Integer
  });

  type FeatureCreationT = t.TypeOf<typeof FeatureCreation>;

  // TODO: This is redundant with the middleware in superuser.ts
  const requireSuperuser = (req: JwtRequest) => {
    return req.auth && req.auth.sub === state.config.superuserAccountId;
  };

  state.app.post(
    "/feature",
    async (req: JwtRequest, res: Response) => {

      const maybe = FeatureCreation.decode(req.body);

      if (isLeft(maybe)) {
        res.statusCode = 400;
        res.json({ error: true, message: `Submission did not match schema: ${PathReporter.report(maybe).join("\n")}` });
        return;
      }

      const input: FeatureCreationT = maybe.right;

      const record: MongoSceneFeature = {
        scene_id: new ObjectId(input.scene_id),
        feature_time: new Date(input.feature_time),
      };

      try {
        const result = await state.features.insertOne(record);

        res.json({
          error: false,
          id: "" + result.insertedId,
        });
      } catch (err) {
        console.error(`${req.method} ${req.path} exception`, err);
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
      }
    }
  );


  state.app.get(
    "/feature/:date",
    async (req: JwtRequest, res: Response) => {
      const date = new Date(req.params.date);
      if (isNaN(date.getTime())) {
        res.status(400).json({
          error: true,
          message: "Invalid date specified"
        });
        return;
      }

      const feature = await getFeatureForDate(state, date);
      if (feature === null) {
        res.status(404).json({
          error: true,
          message: "No feature found for given date"
        });
        return;
      }

      const hydrated = await hydratedFeature(state, feature, req);
      
      res.json({
        error: false,
        feature: hydrated 
      });

    });

    state.app.get(
      "/features",
      async (req: JwtRequest, res: Response) => {
        const startDate = new Date(Number(req.query.start_date));
        const endDate = new Date(Number(req.query.end_date));

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          res.status(400).json({
            error: true,
            message: "Invalid start and end date formats"
          });
          return;
        }

        const features = await getFeaturesForRange(state, startDate, endDate);
        const hydratedFeatures: HydratedSceneFeature[] = [];
        for await (const feature of features) {
          const hydrated = await hydratedFeature(state, feature, req);
          hydratedFeatures.push(hydrated);
        }

        res.json({
          error: false,
          features: hydratedFeatures
        });
      });

      state.app.get(
        "/features/queue",
        async (req: JwtRequest, res: Response) => {
          const queueDoc = await state.featureQueue.findOne();
          const sceneIDs = queueDoc?.scene_ids ?? [];
          if (sceneIDs.length === 0) {
            res.status(500).json({
              error: true,
              message: "No scene present in queue",
            });
            return;
          }

          const scenes: Record<string, any>[] = [];
          for (const id of sceneIDs) {
            const scene = await state.scenes.findOne({ "_id": new ObjectId(id) });
            if (scene === null) {
              throw new Error(`Database consistency failure, feature queue missing scene ${id}`);
            }
            const sceneJson = await sceneToJson(scene, state, req.session);
            scenes.push(sceneJson);
          }

          res.json({
            error: false,
            scenes
          });

        });

      state.app.get(
        "/features/queue/next",
        async (req: JwtRequest, res: Response) => {
          const queueDoc = await state.featureQueue.findOne({ queue: true });
          const sceneIDs = queueDoc?.scene_ids ?? [];
          if (sceneIDs.length === 0) {
            res.status(500).json({
              error: true,
              message: "No scenes present in queue",
            });
            return;
          }
          const id = sceneIDs[0];
          
          const scene = await state.scenes.findOne({ "_id": new ObjectId(id) });
          if (scene === null) {
            throw new Error(`Database consistency failure, feature queue missing scene ${id}`);
          }
          const sceneJson = await sceneToJson(scene, state, req.session);

          res.json({
            error: false,
            scene: sceneJson,
          });

        });

      state.app.post(
        "/features/pop",
        async (req: JwtRequest, res: Response) => {
          const result = await state.featureQueue.findOneAndUpdate(
            { queue: true },
            { "$pop": { "scene_ids": 1 } }  // -1 pops the first element: https://www.mongodb.com/docs/manual/reference/operator/update/pop/
          );

          const queueDoc = result.value;
          if (queueDoc === null) {
            throw new Error(`Database failure, queue is missing`);
          }

          const id = queueDoc.scene_ids[0];
          const scene = await state.scenes.findOne({ "_id": new ObjectId(id) });
          if (scene === null) {
            throw new Error(`Database consistency failure, feature queue missing scene ${id}`);
          }
          const sceneJson = await sceneToJson(scene, state, req.session);

          res.json({
            error: false,
            scene: sceneJson
          });
        });

      state.app.post(
        "/features/queue/:id",
        async (req: JwtRequest, res: Response) => {
          const id = req.params.id;
          const objectId = new ObjectId(id);
          const scene = await state.scenes.findOne({ "_id": objectId });

          if (scene === null) {
            res.status(400).json({
              error: true,
              message: `Invalid scene id ${id}`
            });
            return;
          }

          const queueDoc = await state.featureQueue.findOne({ queue: true });
          if (queueDoc === null) {
            throw new Error(`Database failure, queue is missing`);
          }

          const inQueue = queueDoc.scene_ids.some(oid => oid.equals(objectId));
          if (inQueue) {
            res.json({
              error: false,
              message: `Scene ${id} is already in the queue`
            });
            return;
          }

          const updateResult = await state.featureQueue.updateOne(
            { queue: true },
            { "$push": { scene_ids: objectId } }
          );

          if (updateResult.modifiedCount === 0) {
            res.status(500).json({
              error: true,
              message: `Error adding ${id} to queue`,
            });
          } else {
            res.json({
              error: false,
              message: `Scene ${id} added to queue`,
            });
          }

        });

      state.app.delete(
        "/features/queue/:id",
        async (req: JwtRequest, res: Response) => {
          const id = req.params.id;
          const objectId = new ObjectId(id);
          const queueDoc = await state.featureQueue.findOne({ queue: true });
          if (queueDoc === null) {
            throw new Error(`Database failure, queue is missing`);
          }

          const inQueue = queueDoc.scene_ids.some(oid => oid.equals(objectId));

          if (!inQueue) {
            res.json({
              error: false,
              message: `Scene ${id} was not in queue`,
            });
            return;
          }

          const newQueue = queueDoc.scene_ids;
          newQueue.push(objectId);
          const updateResult = await state.featureQueue.updateOne(
            { queue: true },
            { scene_ids: newQueue }
          );
          
          if (updateResult.modifiedCount === 0) {
            res.status(500).json({
              error: true,
              message: `Error removing ${id} from queue`,
            });
          } else {
            res.json({
              error: false,
              message: `Scene ${id} removed from queue`,
            });
          }

        });

}
