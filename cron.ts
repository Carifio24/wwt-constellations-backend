import { ObjectId } from "mongodb";
import { Job, scheduleJob } from "node-schedule";
import { getFeaturesForRange, tryPopNextQueuedSceneId } from "./features.js";
import { State } from "./globals.js";
import { updateTimeline } from "./superuser.js";

export async function dailyFeatureSetup(state: State): Promise<Map<ObjectId, Job>> {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1); // NB, this works even on the 31st of the month

  const features = await getFeaturesForRange(state, now, tomorrow);
  const haveFeatures = await features.hasNext();
  const jobs = new Map();

  if (haveFeatures) {
    for await (const feature of features) {
      let date = new Date(feature.feature_time);
      console.log(`${new Date().toISOString()}: scheduling job for feature ${feature._id} to run at ${date.toISOString()}`);

      // In the unlikely case that the feature time was between
      // the beginning of this function and now (with some tolerance),
      // give it an extra minute so that it doesn't get missed
      if (date.getTime() <= Date.now() + 5000) {
        date = new Date();
        date.setMinutes(date.getMinutes() + 1);
      }

      const featureJob = scheduleJob(
        `Job for feature ${feature._id}`,
        date,
        async function (state: State, id: ObjectId) {
          await updateTimeline(state, id);
        }.bind(null, state, feature._id)
      );

      featureJob.on("run", () => {
        console.log(`${new Date().toISOString()}: ran timeline update job for feature ${feature._id}`);
      });
      featureJob.on("canceled", () => {
        console.log(`${new Date().toISOString()}: the timeline update job for ${feature._id} was canceled!`);
      });
      featureJob.on("error", () => {
        console.error(`${new Date().toISOString()}: there was an error running the timeline update job for ${feature._id}`);
      });

      jobs.set(feature._id, featureJob);
    }
  } else {
    // nextQueuedId may be null here; if it is, the timeline update will use its
    // algorithm to choose the lead scene.
    const nextQueuedId = await tryPopNextQueuedSceneId(state);
    console.log(`${new Date().toISOString()}: no scheduled features; updating timeline using next queued scene ID ${nextQueuedId}`);
    await updateTimeline(state, nextQueuedId);
  }

  return jobs;
}

export function createDailyFeatureUpdateJob(state: State): Job {
  return scheduleJob(
    "Daily feature update job",
    "59 23 * * *",
    async function (state: State) {
      console.log(`${new Date().toISOString()}: running daily update job`);
      const jobs = await dailyFeatureSetup(state);

      jobs.forEach((job, id) => {
        state.scheduledFeatureJobs.set(id, job);
        job.on("run", () => state.scheduledFeatureJobs.delete(id));
        job.on("canceled", () => state.scheduledFeatureJobs.delete(id));
      });
    }.bind(null, state)
  );
}
