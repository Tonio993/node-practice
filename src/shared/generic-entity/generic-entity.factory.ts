import { Knex } from "knex"
import { ModuleDefinition } from "../types/module-definition"
import { toCamelCase } from "../utils/case.util"
import { GenericEntityController } from "./generic-entity.controller"
import { GenericEntityRepository } from "./generic-entity.repository"
import { GenericEntityRoutes } from "./generic-entity.router"
import { GenericEntityService } from "./generic-entity.service"
import { BaseEntity } from "./generic-entity.type"

export class GenericEntityFactory<T extends BaseEntity> {

    readonly moduleDefinition: ModuleDefinition

    constructor(
        private readonly knex: Knex,
        private readonly entityClass: Function,
        private readonly path?: string
    ) {

        const repo = new GenericEntityRepository<T>(this.knex, this.entityClass)
        const service = new GenericEntityService<T>(repo)
        const controller = new GenericEntityController<T>(service)
        const routes = new GenericEntityRoutes<T>(controller)

        this.moduleDefinition = {
            route: {
                path: `/${this.path || toCamelCase(repo.tableName)}`,
                router: routes.router
            }
        }
    }
}
