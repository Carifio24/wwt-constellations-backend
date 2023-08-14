declare module "d3-geo-voronoi" {
  import "d3-geo-voronoi";
  import { Delaunay } from "d3-delaunay";
  import { Feature, FeatureCollection, MultiLineString, Polygon } from "geojson";

  type PointSpherical = [number, number];
  type Point3D = [number, number, number];
  type Edge = [number, number];

  // See https://www.npmjs.com/package/d3-geo-voronoi for a
  // description of what these values mean
  type GeoDelaunay = {
    delaunay: Delaunay<number>;
    triangles: Point3D[];
    edges: Edge[];
    neighbors: number[][];
    hull: number[];
    find: (x: number, y: number, next?: number) => number;
    mesh: Edge[];
    centers: PointSpherical[];
    polygons: number[][];
    urquhart: (distances: number[]) => boolean[];
  }

  type GeoVoronoi = {
    delaunay: GeoDelaunay;
    polygons: () => FeatureCollection<Polygon>;
    find: (x: number, y: number, next?: number) => number;
    mesh: () => MultiLineString; 
    points: PointSpherical[];
  }

  export function geoDelaunay(points: PointSpherical[]): GeoDelaunay; 
  export function geoVoronoi(points: PointSpherical[]): GeoVoronoi;
}
