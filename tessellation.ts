import { ObjectId, WithId } from "mongodb";
import { MongoScene } from "./scenes.js";
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
  const points: PointSpherical[] = places.map(place => [place.ra_rad * R2D - 180, place.dec_rad * R2D]);
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

export function findCellWithRadius(tessellation: MongoTessellation, raRad: number, decRad: number, radius?: number): number | null {
  const found = findCell(tessellation, raRad, decRad, undefined);
  const foundPoint = tessellation.points[found];
  if (!radius || distance(raRad, decRad, foundPoint[0], foundPoint[1]) < radius) {
    return found;
  } else {
    return null;
  }
}

export function initializeTessellationEndpoints(state: State) {
  state.app.get(
    "/tessellation/:tessellation_id",
    async (req: JwtRequest, res: Response) => {
      const tessellation = await state.tessellations.findOne({ "_id": new ObjectId(req.params.tessellation_id) });

      if (tessellation === null) {
        res.statusCode = 404;
        res.json({ error: true, message: "Not found" });
        return;
      }
      
      res.json({
        tessellation
      });
    }
  );

  state.app.get(
    "/tessellations/:tessellation_id/cell",
    async (req: JwtRequest, res: Response) => {
      const tessellation = await state.tessellations.findOne({ "_id": new ObjectId(req.params.tessellation_id) });

      if (tessellation === null) {
        res.statusCode = 404;
        res.json({ error: true, message: "Not found" });
        return;
      }

      const ra = parseInt(req.query.ra as string);
      const dec = parseInt(req.query.dec as string);
      if (isNaN(ra) || isNaN(dec)) {
        res.statusCode = 400;
        res.json({
          error: true,
          message: "Right ascension and declination must be numbers"
        });
        return;
      }

      const cell = findCellWithRadius(tessellation, ra, dec);
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

      res.json({
        cell_number: cell,
        location: {
          ra: location[0],
          dec: location[1]
        },
        scene_id
      });
    }
  );
}
