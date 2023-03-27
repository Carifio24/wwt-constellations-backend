// Copyright 2023 the .NET Foundation

// A "handle" is a public-facing account such as `@jwst`. We distinguish between
// handles and Keycloak user accounts since we expect that handles will
// regularly be administered by multiple users.
//
// See `SCHEMA.md` for more information about the schema used here.

//import { Request, Response } from "express";
//import { Request as JwtRequest } from "express-jwt";

//import { State } from "./globals";
//import { noAuthErrorHandler } from "./auth";

export interface MongoHandle {
  handle: string;
  display_name: string;
  creation_date: Date;
  owner_accounts: string[];
}

//export function initializeHandleEndpoints(state: State) { }