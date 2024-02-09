import { Express } from "express";
import dotenv from "dotenv";
import { Collection } from "mongodb";
import { AzureLogLevel } from "@azure/logger";

import { MongoHandle } from "./handles";
import { MongoImage } from "./images";
import { MongoScene } from "./scenes";
import { MongoEvent } from "./events";
import { MongoTessellation } from "./tessellation";
import { MongoSceneFeature, MongoSceneFeatureQueue } from "./features";

export class Config {
  // The port number on which the server will listen.
  port: number;

  // The base URL of the Keycloak server. This should end in a slash.
  kcBaseUrl: string;

  // The Keycloak realm in which we operate.
  kcRealm: string;

  // The connection string for the MongoDB storage server.
  mongoConnectionString: string;

  // The MongoDB database name in which we operate.
  mongoDbName: string;

  // Preview base URL
  previewBaseUrl: string;

  // Secrets used to hash session cookies. The first item in the list is the
  // active secret used for new sessions; other items are older secrets that are
  // used for checking. So, as we rotate secrets, we move them backwards in the
  // list and eventually drop them when we're comfortable with resetting their
  // corresponding sessions.
  sessionSecrets: string[];
  // 
  // Previewer server URL
  previewerUrl: string;

  // The Keycloak ID of the "superuser" user. This account can access a few
  // highly privileged operations that set up administration of the website
  // through more regular IAM channels. If this is set to some kind of dummy
  // value, then no one is superuser.
  superuserAccountId: string;

  // The logging level to use through the application.
  logLevel: AzureLogLevel;

  // A "secret key" used to authenticate other Constellations services
  frontendAutonomousKey: string;

  constructor() {
    dotenv.config();

    const portstr = process.env.PORT ?? "7000"; // Azure might tell us which port to listen on
    this.port = parseInt(portstr, 10);

    this.kcBaseUrl = process.env.KEYCLOAK_URL ?? "http://localhost:8080/";
    if (!this.kcBaseUrl.endsWith("/")) {
      this.kcBaseUrl += "/";
    }

    this.kcRealm = "constellations";

    const connstr = process.env.AZURE_COSMOS_CONNECTIONSTRING ?? process.env.MONGO_CONNECTION_STRING;
    if (connstr === undefined) {
      throw new Error("must define $AZURE_COSMOS_CONNECTIONSTRING or $MONGO_CONNECTION_STRING");
    }

    this.mongoConnectionString = connstr;
    this.mongoDbName = "constellations";
    this.previewBaseUrl = process.env.CX_PREVIEW_BASE_URL ?? "";
    this.sessionSecrets = (process.env.CX_SESSION_SECRETS ?? "dev-secret").split(" ");
    const previewerUrl = process.env.CX_PREVIEW_SERVICE_URL;
    if (previewerUrl === undefined) {
      throw new Error("must define $CX_PREVIEW_SERVICE_URL");
    }
    this.previewerUrl = previewerUrl;
    this.superuserAccountId = process.env.CX_SUPERUSER_ACCOUNT_ID ?? "nosuperuser";

    this.logLevel = process.env.CX_LOG_LEVEL as AzureLogLevel ?? "info";

    const frontendKey = process.env.CX_FRONTEND_AUTONOMOUS_KEY;
    if (frontendKey === undefined) {
      throw new Error("must define $CX_FRONTEND_AUTONOMOUS_KEY");
    }
    this.frontendAutonomousKey = frontendKey;
  }
}

export class State {
  config: Config;
  app: Express;
  scenes: Collection<MongoScene>;
  images: Collection<MongoImage>;
  handles: Collection<MongoHandle>;
  events: Collection<MongoEvent>;
  features: Collection<MongoSceneFeature>;
  featureQueue: Collection<MongoSceneFeatureQueue>;
  tessellations: Collection<MongoTessellation>;

  constructor(
    config: Config,
    app: Express,
    scenes: Collection<MongoScene>,
    images: Collection<MongoImage>,
    handles: Collection<MongoHandle>,
    events: Collection<MongoEvent>,
    features: Collection<MongoSceneFeature>,
    featureQueue: Collection<MongoSceneFeatureQueue>,
    tessellations: Collection<MongoTessellation>,
  ) {
    this.config = config;
    this.app = app;
    this.scenes = scenes;
    this.images = images;
    this.handles = handles;
    this.events = events;
    this.features = features;
    this.featureQueue = featureQueue;
    this.tessellations = tessellations;
  }
}
