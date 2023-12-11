import * as t from "io-ts";
import * as tc from "io-ts-types";
import { ObjectId } from "mongodb";

import { State } from "./globals.js";

export interface MongoSceneFeature {
  scene_id: ObjectId; 
  feature_time: Date;
}

export async function getFeatureForDate(state: State, date: Date): Promise<MongoSceneFeature | null> {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
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

export function initializeFeatureEndpoints(state: State) {
  const FeatureCreation = t.type({
    scene_id: t.string,
    feature_time: tc.date
  });
}
