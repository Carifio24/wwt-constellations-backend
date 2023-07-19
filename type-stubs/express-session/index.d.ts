import "express-session";

declare module "express-session" {

  interface Impression {
    scene_id: string,
    last: number
  }

  interface Likes {
    scene_id: string,
  }

  interface Shares {
    scene_id: string;
    type: string;
  }

  interface Session {
    impressions: Impression[],
    likes: Likes[],
    created: number,
    shares: Shares[],
  }
}
