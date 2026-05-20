import { Router } from "express";
import { GenericEntityController } from "./generic-entity.controller";
import { BaseEntity } from "./generic-entity.type";

export class GenericEntityRoutes<T extends BaseEntity> {
    readonly router: Router

    constructor(
        private readonly controller: GenericEntityController<T>
    ) {
        this.router = Router()

        this.router.get('/', controller.findAll)
        this.router.get('/:id', controller.findById)

        this.router.post('/', controller.insert)

        this.router.put('/:id', controller.update)

        this.router.delete('/:id', controller.delete)
    }

}
