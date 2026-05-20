import { Router } from "express"

export interface ModuleDefinition {
    route?: {
        path: string,
        router: Router
    }
}