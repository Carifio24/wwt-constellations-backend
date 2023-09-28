import { WithId } from "mongodb";
import { distance } from "@wwtelescope/astro";

import { MongoScene } from "./scenes";

export interface ScoreWeights {
  time: number;
  popularity: number;
  distance: number;
  variety: number;
}

const DEFAULT_WEIGHTS: ScoreWeights = {
  time: 1,
  popularity: 1,
  distance: 1,
  variety: 1
};

export interface FeedSortingItem {
  scene: WithId<MongoScene>;
  popularityComponent: number;
  distanceComponent: number;
  varietyComponent: number;
  timeComponent: number;
}

export type Feed = WithId<MongoScene>[];

function score(item: FeedSortingItem, weights: ScoreWeights = DEFAULT_WEIGHTS): number {
  return weights.time * item.timeComponent +
    weights.popularity * item.popularityComponent +
    weights.distance * item.distanceComponent +
    weights.variety * item.varietyComponent;
}

export interface FeedConstructionParams {
  scenes: WithId<MongoScene>[];
  initialScene?: WithId<MongoScene> | null;
  weights?: ScoreWeights;
  firstNDistinctHandles?: number;
  size?: number;
}

interface NextSceneParams {
  items: FeedSortingItem[];
  feed: Feed;
  handleCounts: Record<string, number>;
  weights: ScoreWeights;
  firstNDistinctHandles: number;
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

function nextScene(params: NextSceneParams): WithId<MongoScene> | null {
  if (params.items.length === 0) {
    return null;
  }

  const { feed, items, handleCounts, weights, firstNDistinctHandles } = params;
  const mostRecent = feed[feed.length - 1];
  items.forEach(item => {
    const handleCount = handleCounts[item.scene.handle_id.toString()] || 0;
    item.varietyComponent = handleCountComponent(handleCount);

    const dist = distanceBetween(mostRecent, item.scene);
    item.distanceComponent = distanceComponent(dist);
  });

  const weightScore = (item: FeedSortingItem) => score(item, weights);
  items.sort((a, b) => weightScore(b) - weightScore(a));

  if (feed.length < firstNDistinctHandles) {
    let index = 0;
    while (index < items.length) {
      const item = items[index];
      const handle = item.scene.handle_id.toString();
      if (!(handle in handleCounts)) {
        handleCounts[handle] = 1;
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
    if (handle in handleCounts) {
      handleCounts[handle] += 1;
    } else {
      handleCounts[handle] = 1;
    }
    return scene;
  }
}

export function constructFeed(params: FeedConstructionParams): Feed {
  const initialScene = params.initialScene;
  const haveInitialScene = initialScene != null;
  const feed: Feed = haveInitialScene ? [initialScene] : [];
  const handleCounts: Record<string, number> = {};

  // Unpack our parameters and set reasonable defaults
  let scenes = params.scenes;
  const firstNDistinctHandles = params.firstNDistinctHandles ?? 5;
  const weights = params.weights ?? DEFAULT_WEIGHTS;
  const size = params.size ?? Infinity;

  if (haveInitialScene) {
    handleCounts[initialScene.handle_id.toString()] = 1;

    // Note that comparing ObjectIds with ==/!= does not do what you would hope :-(
    scenes = scenes.filter((s) => !s._id.equals(initialScene._id));
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
  const millisecondsPerWeek = 1000 * 60 * 60 * 24 * 7;
  const timeDecay = halfLogisticDecay(0.01, millisecondsPerWeek);
  times.forEach((t, idx) => {
    remainingScenes[idx].timeComponent = timeDecay(t);
  });

  remainingScenes.sort((a, b) => score(b) - score(a));

  // Get an initial scene, if we need one
  if (!haveInitialScene) {
    const firstScene = remainingScenes.shift()!.scene;
    feed.push(firstScene);
    handleCounts[firstScene.handle_id.toString()] = 1;
  }

  // Now we can take the handle and location into account

  let next: WithId<MongoScene> | null = null;

  while (feed.length < size &&
         (next = nextScene({ items: remainingScenes, handleCounts, feed, weights, firstNDistinctHandles })) !== null) {
    feed.push(next);
  }

  return feed;
}

