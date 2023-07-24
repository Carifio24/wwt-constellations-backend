// Copyright 2023 the .NET Foundation

// An event is a bit of telemetry that we record for analytics.
//
// See `SCHEMA.md` for more information about the schema used here.

import { Request as JwtRequest } from "express-jwt";
import { ObjectId } from "mongodb";

import { State } from "./globals";
import { SceneShareType } from "./scenes";

export interface MongoEvent {
  kind: string;
  sid: string;
  date: Date;
}

export interface MongoClickEvent extends MongoEvent {
  kind: "click";
  scene_id: ObjectId;
}

export async function logClickEvent(state: State, req: JwtRequest, scene_id: ObjectId) {
  const evt: MongoClickEvent = {
    kind: "click",
    sid: req.session.id,
    date: new Date(),
    scene_id
  };

  await state.events.insertOne(evt);
  await state.scenes.findOneAndUpdate({ "_id": scene_id }, { $inc: { clicks: 1 } })
}

export interface MongoImpressionEvent extends MongoEvent {
  kind: "impression";
  scene_id: ObjectId;
}

export async function logImpressionEvent(state: State, req: JwtRequest, scene_id: ObjectId) {
  const evt: MongoImpressionEvent = {
    kind: "impression",
    sid: req.session.id,
    date: new Date(),
    scene_id
  };

  await state.events.insertOne(evt);
  await state.scenes.findOneAndUpdate({ "_id": scene_id }, { $inc: { impressions: 1 } })
}

export interface MongoLikeEvent extends MongoEvent {
  kind: "like";
  scene_id: ObjectId;
  delta: number;
}

export async function logLikeEvent(state: State, req: JwtRequest, scene_id: ObjectId, delta: number) {
  const evt: MongoLikeEvent = {
    kind: "like",
    sid: req.session.id,
    date: new Date(),
    scene_id,
    delta,
  };

  await state.events.insertOne(evt);
  await state.scenes.findOneAndUpdate({ "_id": scene_id }, { $inc: { likes: delta } })
}

export interface MongoShareEvent extends MongoEvent {
  kind: "share";
  scene_id: ObjectId;
  type: SceneShareType;
}

export async function logShareEvent(state: State, req: JwtRequest, scene_id: ObjectId, type: SceneShareType) {
  const evt: MongoShareEvent = {
    kind: "share",
    sid: req.session.id,
    date: new Date(),
    scene_id,
    type
  };

  await state.events.insertOne(evt);
  await state.scenes.findOneAndUpdate({ "_id": scene_id }, { $inc: { shares: 1 } });
}
