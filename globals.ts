import { Express } from "express";
import dotenv from "dotenv";
import { Collection, Document } from "mongodb";

import { MongoHandle } from "./handles";

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

  // The Keycloak ID of the "superuser" user. This account can access a few
  // highly privileged operations that set up administration of the website
  // through more regular IAM channels. If this is set to some kind of dummy
  // value, then no one is superuser.
  superuserAccountId: string;

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

    this.superuserAccountId = process.env.CX_SUPERUSER_ACCOUNT_ID ?? "nosuperuser";
  }
}

export class State {
  config: Config;
  app: Express;
  scenes: Collection<Document>;
  images: Collection<Document>;
  handles: Collection<MongoHandle>;

  constructor(
    config: Config,
    app: Express,
    scenes: Collection<Document>,
    images: Collection<Document>,
    handles: Collection<MongoHandle>,
  ) {
    this.config = config;
    this.app = app;
    this.scenes = scenes;
    this.images = images;
    this.handles = handles;
  }
}
