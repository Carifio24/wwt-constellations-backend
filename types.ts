export interface PlaceDetails {
  raRad: number;
  decRad: number;
  zoomDeg: number;
  rollRad?: number;
}

export function isPlaceDetails(item: any): item is PlaceDetails {
  return typeof item.raRad === "number" &&
         typeof item.decRad === "number" &&
         typeof item.zoomDeg === "number" &&
         item.rollRad === undefined || typeof item.rollRad === "number";
}

export interface ImagesetLayerDetails {
  url: string;
  name: string;
  opacity: number;
}

export function isImagesetLayerDetails(item: any): item is ImagesetLayerDetails {
  return typeof item.url === "string" &&
         typeof item.name === "string" &&
         typeof item.opacity === "number";
}

export interface Scene {
  name: string;
  imagesetLayers: ImagesetLayerDetails[];
  background: string;
  user: string;
  place: PlaceDetails;
}

export function isScene(item: any): item is Scene {
  const types = Array.isArray(item.imagesetLayers) &&
                typeof item.name === "string" &&
                typeof item.user === "string" &&
                typeof item.background == "string" &&
                isPlaceDetails(item.place);
    if (!types) {
      return types;
    }

  return item.imagesetLayers.every(isImagesetLayerDetails);
}

export type OptionalFields<T> = {
  [P in keyof T]?: OptionalFields<T[P]>
}

export type SceneKeys = keyof Scene | "id";
export type SceneSettings = OptionalFields<Scene> & { id: string };

export function isSceneSettings(item: any): item is SceneSettings {
  const types = (item.imagesetLayers === undefined || Array.isArray(item.imagesetLayers)) &&
                (item.name === undefined || typeof item.name === "string") &&
                (item.user === undefined || typeof item.user === "string") &&
                (item.place === undefined || isPlaceDetails(item.place));
    if (!types) {
      return types;
    }

  return (!!item.imagesetLayers) || (item.imagesetLayers.every(isImagesetLayerDetails));
}
