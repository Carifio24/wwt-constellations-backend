import { ObjectId, WithId } from "mongodb";
import { MongoScene, sceneToJson } from "./scenes.js";
import { distance, D2R, R2D } from "@wwtelescope/astro";
import { GeoVoronoi, geoVoronoi, PointSpherical } from "d3-geo-voronoi";
import { Response } from "express";
import { Request as JwtRequest } from "express-jwt";
import { State } from "./globals.js";

export interface MongoTessellation {
  name: string;
  neighbors: number[][];
  polygons: PointSpherical[][];
  scene_ids: ObjectId[];
  points: number[][];
  last_updated: Date;
}

export function createVoronoi(scenes: WithId<MongoScene>[]): GeoVoronoi {
  const places = scenes.map(scene => scene.place);
  const points: PointSpherical[] = places.map(place => {
    let raDeg = place.ra_rad * R2D;
    if (raDeg > 180) {
      raDeg -= 360;
    }
    return [raDeg, place.dec_rad * R2D];
  });
  return geoVoronoi(points);
}

export function createTessellation(scenes: WithId<MongoScene>[], name: string): MongoTessellation {
  const voronoi = createVoronoi(scenes);
  const polygons: PointSpherical[][] = voronoi.polygons().features.map(polygon => {
    return polygon.geometry.coordinates[0].map(p => [p[0] * D2R, p[1] * D2R]);
  });
  return {
    name,
    neighbors: voronoi.delaunay.neighbors,
    points: voronoi.points.map(p => [p[0] * D2R, p[1] * D2R]),
    polygons,
    scene_ids: scenes.map(scene => new ObjectId(scene._id.toString())),
    last_updated: new Date(),
  };
}

export function findCell(tessellation: MongoTessellation, raRad: number, decRad: number, next?: number | null): number {
  if (next == null) {
    next = 0;
  }
  let found = next;
  let cell = 0;
  let dist = 0;
  do {
    cell = next || 0;
    next = null;
    const pt = tessellation.points[cell];
    dist = distance(raRad, decRad, pt[0], pt[1]);
    tessellation.neighbors[cell].forEach((i) => {
      const p = tessellation.points[i];
      const ndist = distance(raRad, decRad, p[0], p[1]);
      if (ndist < dist) {
        dist = ndist;
        next = i;
        found = i;
        return;
      }
    });
  } while (next !== null);

  return found;
}

/**
  * In principle, the global tessellation should include all of the scenes.
  * However, this will generally be problematic, as having multiple scenes
  * at the same location will lead to degenerate (i.e. single-point) polygons.
  * (In our d3-geo-voronoi implementation, these don't get added, and lead to
  * a mismatch between cell and polygons indices, which is very bad!)
  * To get around this, we only use a subset of scenes. Going from most to
  * least popular, we only 'accept' scenes that are a certain minimum distance
  * away from any other scene that we've used already (essentially giving each
  * scene a minimum 'size'). Note that if the home timeline ordering changes,
  * re-running this will give a different result
  */
async function createGlobalTessellation(state: State, minDistance=0.02): Promise<MongoTessellation> {
  const scenes = state.scenes.find({}).sort({ home_timeline_sort_key: 1 });
  const tessellationScenes: WithId<MongoScene>[] = [];
  for await (const scene of scenes) {
    const place = scene.place;
    const accept = tessellationScenes.every(s => {
      return distance(place.ra_rad, place.dec_rad, s.place.ra_rad, s.place.dec_rad) > minDistance;
    });
    if (accept) {
      tessellationScenes.push(scene);
    }
  }

  return createTessellation(tessellationScenes, "global");
}

function nearbySceneIDs(sceneID: ObjectId, baseTessellation: MongoTessellation, size: number): ObjectId[] {
  const sceneIDs: ObjectId[] = [sceneID];
  const index = baseTessellation.scene_ids.findIndex((id) => id.equals(sceneID));
  if (index < 0) {
    return sceneIDs;
  }
  const queue: number[] = [index];
  const visited = new Set<number>();
  while (sceneIDs.length < size && queue.length > 0) {
    const sceneIndex = queue.shift();
    if (sceneIndex === undefined || visited.has(sceneIndex)) {
      continue;
    }
    visited.add(sceneIndex);
    sceneIDs.push(baseTessellation.scene_ids[sceneIndex]);
    const neighbors = baseTessellation.neighbors[sceneIndex];
    queue.push(...neighbors);
  }
  return sceneIDs;
}



export function initializeTessellationEndpoints(state: State) {

  /** 
    * This route has the ability to specify an ID or a tessellation 'name'
    * which is something that I'm imagining being unique.
    * The idea being that if we want something out of, say, the global tessellation
    * the frontend can just ask for 'global', rather than needing to know the
    * the tessellation ID
    */
  state.app.get(
    "/tessellations/cell",
    async (req: JwtRequest, res: Response) => {
      const tessellation = await state.tessellations.findOne({ name: req.query.name as string });

      if (tessellation === null) {
        res.statusCode = 404;
        res.json({ error: true, message: "Not found" });
        return;
      }

      const ra = parseFloat(req.query.ra as string);
      const dec = parseFloat(req.query.dec as string);
      if (isNaN(ra) || isNaN(dec)) {
        res.statusCode = 400;
        res.json({
          error: true,
          message: "Right ascension and declination must be numbers"
        });
        return;
      }

      const cell = findCell(tessellation, ra, dec);
      if (cell === null) {
        res.statusCode = 500;
        res.json({
          error: true,
          message: "Unable to find cell for given location"
        });
        return;
      }

      const location = tessellation.points[cell];
      const scene_id = tessellation.scene_ids[cell];
      const neighbors = tessellation.neighbors[cell].map(index => tessellation.scene_ids[index]);

      res.json({
        neighbors,
        location: {
          ra: location[0],
          dec: location[1]
        },
        scene_id
      });
    }
  );

  // TODO: Where should this go?
  state.app.get(
    "/tessellations/nearby-feed/:sceneID",
    async (req: JwtRequest, res: Response) => {
      const tessellation = await state.tessellations.findOne({ name: "global" });
      if (tessellation === null) {
        res.statusCode = 500;
        res.json({ error: true, message: "error finding global tessellation" });
        return;
      }

      if (req.query.size === undefined) {
        res.statusCode = 400;
        res.json({ error: true, message: "invalid size" });
        return;
      }
      const size = parseInt(req.query.size as string, 10);
      const sceneID = new ObjectId(req.params.sceneID as string);
      const nearbyIDs = nearbySceneIDs(sceneID, tessellation, size);
      const docs = state.scenes.find({ _id: { "$in": nearbyIDs } });

      const scenes = [];
      for await (const doc of docs) {
        scenes.push(await sceneToJson(doc, state, req.session)); 
      }

      res.json({
        error: false,
        results: scenes
      });
    });

}
