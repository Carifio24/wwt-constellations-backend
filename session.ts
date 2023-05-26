
import { Response } from "express";
import { Request as JwtRequest } from "express-jwt";
import { State } from "./globals";



export function isValid(req: JwtRequest) : boolean {
    // Check that session exist and has not been created during this request.
    return req.session && (req.session.created + 500) < Date.now();
}


export function isValidImpression(req: JwtRequest) : boolean {
    // Rate limit user impressions
    const timeoutMs = 10000;
    let isValidRate = true;
    const sceneImpression = req.session?.impressions?.find(x => x.scene_id == req.params.id);
    if (sceneImpression) {
        isValidRate = (sceneImpression.last + timeoutMs) <  Date.now();
    }

    return isValid(req) && isValidRate;
}

export function addImpression(req: JwtRequest): boolean {
    const now =  Date.now();

    if (isValidImpression(req)) {
        if (!req.session.impressions) {
            req.session.impressions = [];
        }
        const sceneImpression = req.session?.impressions?.find(x => x.scene_id == req.params.id);
        if (sceneImpression) {
            sceneImpression.impressions++;
            sceneImpression.last = now;
        } else {
            req.session.impressions.push({impressions: 1, scene_id: req.params.id, last: now})
        }

        return true;
    }

    return false;
}

export function isValidLike(req: JwtRequest) {
    return isValid(req) && (!req.session?.likes?.some(x => x.scene_id == req.params.id) ?? true);
}

export function addLike(req: JwtRequest): boolean {
    if (isValidLike(req)) {
        if (!req.session.likes) {
            req.session.likes = [];
        }

        req.session.likes.push({scene_id: req.params.id});
        return true;
    }

    return false;
}


export function isValidRemoveLike(req: JwtRequest) {
    return req.session?.likes?.some(scene => scene.scene_id == req.params.id) ?? false;
}

export function removeLike(req: JwtRequest): boolean {
    if (isValidRemoveLike(req)) {
        req.session.likes = req.session.likes.filter(l => l.scene_id != req.params.id);
        return true;
    }
    
    return false;
}

export function initializeSessionEndpoints(state: State) {
    state.app.post("/session/init", async (req: JwtRequest, res: Response) => {
        req.session.created = Date.now();
        res.statusCode = 200;
        res.json({
            error: false,
        });
    });
}