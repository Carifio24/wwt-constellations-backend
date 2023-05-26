import "express-session";

declare module "express-session" {

  interface Impression {
    scene_id: string,
    impressions: number,
    last: number
  }

  interface Likes {
    scene_id: string,
  }

  interface Session {
    impressions: Impression[],
    likes: Likes[],
    created: number
  }
}
