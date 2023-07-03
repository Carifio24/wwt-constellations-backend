
import { Response } from "express";
import { Request as JwtRequest } from "express-jwt";
import { State } from "./globals";
import { Session } from "express-session"


// Check that session exist and has not been created during this request.
export function isValidSession(session: Session): boolean {
    return session && (session.created + 500) < Date.now();
}

// Check that the user has not already seen this scene recently.
export function isValidImpression(session: Session, id: string): boolean {
    // Rate limit user impressions
    const timeoutMs = 10000;
    let isValidRate = true;
    const sceneImpression = session?.impressions?.find(x => x.scene_id == id);
    if (sceneImpression) {
        isValidRate = (sceneImpression.last + timeoutMs) < Date.now();
    }

    return isValidSession(session) && isValidRate;
}

// Add an impression to the session
export function tryAddImpressionToSession(session: Session, id: string): boolean {
    const now = Date.now();

    if (isValidImpression(session, id)) {
        if (!session.impressions) {
            session.impressions = [];
        }

        const sceneImpression = session?.impressions?.find(x => x.scene_id == id);
        if (sceneImpression) {
            sceneImpression.last = now;
        } else {
            session.impressions.push({ scene_id: id, last: now })
        }

        return true;
    }

    return false;
}

// Check that the session has not liked the given scene
export function isValidLike(session: Session, id: string) {
    return isValidSession(session) && (!session?.likes?.some(l => l.scene_id == id) ?? true);
}

// Add a like to the session
export function tryAddLikeToSession(session: Session, id: string): boolean {
    if (isValidLike(session, id)) {
        if (!session.likes) {
            session.likes = [];
        }

        session.likes.push({ scene_id: id });
        return true;
    }

    return false;
}

// Check that the session has a like for the given scene
export function isValidRemoveLike(session: Session, id: string) {
    return session?.likes?.some(scene => scene.scene_id == id) ?? false;
}

// Remove a like from the session
export function tryRemoveLikeFromSession(session: Session, id: string): boolean {
    if (isValidRemoveLike(session, id)) {
        session.likes = session.likes.filter(l => l.scene_id != id);
        return true;
    }

    return false;
}

// POST /session/init - Initialize a session
export function initializeSessionEndpoints(state: State) {
    state.app.post("/session/init", async (req: JwtRequest, res: Response) => {
        req.session.created = Date.now();
        res.statusCode = 200;
        res.json({
            error: false,
        });
    });
}