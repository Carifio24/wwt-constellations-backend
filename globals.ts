import { Express } from "express";
import dotenv from "dotenv";
import { Collection, Document } from "mongodb";

export class Config {
  port: number;
  kcBaseUrl: string;
  kcRealm: string;
  mongoConnectionString: string;
  mongoDbName: string;

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
  }
}

export class State {
  config: Config;
  app: Express;
  scenes: Collection<Document>;
  images: Collection<Document>;

  constructor(config: Config, app: Express, scenes: Collection<Document>, images: Collection<Document>) {
    this.config = config;
    this.app = app;
    this.scenes = scenes;
    this.images = images;
  }
}
