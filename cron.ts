import { ObjectId } from "mongodb";
import { Job, scheduleJob } from "node-schedule";
import { getFeaturesForRange, nextQueuedSceneId, tryPopFromFeatureQueue } from "./features.js";
import { State } from "./globals.js";
import { updateTimeline } from "./superuser.js";

export async function dailyFeatureSetup(state: State): Promise<Map<ObjectId, Job>> {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const features = await getFeaturesForRange(state, now, tomorrow);
  const haveFeatures = await features.hasNext();

  const jobs = new Map();

  if (haveFeatures) {
    for await (const feature of features) {
      let date = new Date(feature.feature_time);

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
        async function(state: State, id: ObjectId) {
          await updateTimeline(state, id);
        }.bind(null, state, feature._id)
      );
      jobs.set(feature._id, featureJob);
    }
  } else {
    const nextQueuedId = await nextQueuedSceneId(state);
    await updateTimeline(state, nextQueuedId);
    
    tryPopFromFeatureQueue(state);
  }
  return jobs;

}

export function createDailyFeatureUpdateJob(state: State): Job {
  return scheduleJob(
    "Daily feature update job",
    "59 23 * * *",
    async function(state: State) {
      const jobs = await dailyFeatureSetup(state);
      jobs.forEach((job, id) => {
        state.scheduledFeatureJobs.set(id, job);
        job.on("run", () => state.scheduledFeatureJobs.delete(id));
        job.on("canceled", () => state.scheduledFeatureJobs.delete(id));
      });
    }.bind(null, state)
  );
}
