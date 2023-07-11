import { Response } from "express";
import { Request as JwtRequest } from "express-jwt";
import type { AnyBulkWriteOperation, WithId } from "mongodb";
import { distance } from "@wwtelescope/astro";

import { State } from "./globals";
import { MongoScene, ScenePlaceT } from "./scenes";

const TIME_WEIGHT = 1;
const POPULARITY_WEIGHT = 1;
const DISTANCE_WEIGHT = 1;
const VARIETY_WEIGHT = 1;

export interface FeedSortingItem {
  scene: WithId<MongoScene>;
  popularityComponent: number;
  distanceComponent: number;
  varietyComponent: number;
  timeComponent: number;
}

export type Feed = WithId<MongoScene>[];

function score(item: FeedSortingItem): number {
  return TIME_WEIGHT * item.timeComponent +
    POPULARITY_WEIGHT * item.popularityComponent +
    DISTANCE_WEIGHT * item.distanceComponent +
    VARIETY_WEIGHT * item.varietyComponent;
}


/** This is a general logistic decay function, scaled so that the maximum value is 1 */
function logisticDecay(k: number, t0: number, a: number): (t: number) => number {
  return (t: number) => (1 + a * Math.exp(-k * t0)) / (1 + a * Math.exp(k * (t - t0)));
}

/**
  * This is a two-parameter logistic decay where a has been chosen such that f(t0) = 1/2
  * I don't know if there's a particular advantage to this, but it makes t0 have a 
  * more readily apparent meaning
  */
function halfLogisticDecay(k: number, t0: number): (t: number) => number {
  const a = 1 + 2 * Math.exp(-k * t0);
  return logisticDecay(k, t0, a);
}

function sinExpWeight(x: number): number {
  return Math.sin(Math.exp(-Math.pow(x, 2)) * x);
}

function handleCountComponent(n: number): number {
  return Math.exp(-n / 5);
}

function distanceComponent(d: number): number {
  return sinExpWeight((10 * d - 1) / 2);
}

function popularity(scene: MongoScene): number {
  return 2 * scene.likes + scene.impressions;
}

function timeSinceCreation(scene: MongoScene): number {
  return Date.now() - scene.creation_date.getTime();
}

function distanceBetween(scene1: MongoScene, scene2: MongoScene): number {
  return distance(scene1.place.ra_rad, scene1.place.dec_rad, scene2.place.ra_rad, scene2.place.dec_rad);
}

function nextScene(items: FeedSortingItem[], feed: Feed, handles: Record<string, number>, firstN: number): WithId<MongoScene> | null {
  if (items.length === 0) {
    return null;
  }
  items.forEach(item => {
    const handleCount = handles[item.scene.handle_id.toString()] || 0;
    item.varietyComponent = handleCountComponent(handleCount);

    const dist = distanceBetween(feed[0], item.scene);
    item.distanceComponent = distanceComponent(dist);
  });
  
  items.sort((a, b) => score(b) - score(a));

  if (feed.length < firstN) {
    let index = 0;
    while (index < items.length) {
      const item = items[index];
      const handle = item.scene.handle_id.toString();
      if (!(handle in handles)) {
        handles[handle] = 1;
        return items.splice(index, 1)[0].scene;
      }
      index++;
    }
    return null;

  } else {
    const scene = items.shift()?.scene ?? null;
    if (scene === null) {
      return null;
    }
    const handle = scene.handle_id.toString();
    if (handle in handles) {
      handles[handle] += 1;
    } else {
      handles[handle] = 1;
    }
    return scene;
  }
}

function constructFeed(scenes: WithId<MongoScene>[], initialScene: WithId<MongoScene> | null = null, firstN = 5): Feed {
  const haveInitialScene = initialScene !== null;
  const feed: Feed = haveInitialScene ? [initialScene] : [];
  const handles: Record<string, number> = {};
  if (haveInitialScene) {
    handles[initialScene.handle_id.toString()] = 1;
    const index = scenes.indexOf(initialScene);
    if (index > -1) {
      scenes.splice(index, 1);
    }
  }

  const remainingScenes: FeedSortingItem[] = scenes.map(scene => {
    return {
      scene,
      popularityComponent: 0,
      distanceComponent: 0,
      varietyComponent: 0,
      timeComponent: 0
    };
  });

  // Popularity and time since creation are properties of the item itself - 
  // that is, they don't depend at all on the other contents of the feed.
  // Thus we can compute those first, and only once.
  const popularities = scenes.map(scene => popularity(scene));
  const maxPopularity = Math.max(...popularities);
  popularities.forEach((p, idx) => {
    remainingScenes[idx].popularityComponent = p / maxPopularity;
  });

  const times = scenes.map(scene => timeSinceCreation(scene));
  const secondsPerDay = 1000 * 60 * 60 * 24 * 7;
  const timeDecay = halfLogisticDecay(0.01, secondsPerDay); 
  times.forEach((t, idx) => {
    remainingScenes[idx].timeComponent = timeDecay(t);
  });
  remainingScenes.sort((a, b) => score(b) - score(a));

  // Get an initial scene, if we need one
  if (!haveInitialScene) {
    const handles: Record<string, number> = {};
    const firstScene = remainingScenes.shift()!.scene;
    feed.push(firstScene);
    handles[firstScene.handle_id.toString()] = 1;
  }

  // Now we can take the handle and location into account
  let next;
  while ((next = nextScene(remainingScenes, feed, handles, firstN)) !== null) {
    feed.push(next);
  }
  return feed;
}


export function initializeAlgorithmEndpoints(state: State) {

  state.app.post(
    "/algorithm/update",
    async (req: JwtRequest, res: Response) => {
      const allowed = req.auth && req.auth.sub === state.config.superuserAccountId;

      if (!allowed) {
        res.json({ error: true, message: "Forbidden" });
      }

      // No input to parse - since we've verified that it's the superuser
      // making the request, we can just update the scene ordering
      const scenes = await state.scenes.find().toArray();
      const orderedFeed = constructFeed(scenes);
      const operations: AnyBulkWriteOperation<MongoScene>[] = [];
      
      orderedFeed.forEach((scene, index) => {
        // The actual scoring value for each scene doesn't matter
        // All we need is the index that tells us the order
        const operation: AnyBulkWriteOperation<MongoScene> = {
          updateOne: {
            filter: { _id: scene._id },
            update: { $set: { home_timeline_sort_key: index } }
          }
        };
        operations.push(operation);
      });

      state.scenes.bulkWrite(operations);

    });

}
