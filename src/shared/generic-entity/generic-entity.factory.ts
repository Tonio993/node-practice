import { Knex } from "knex"
import { CanonicalSchemaDefinition } from "./canonical-schema-definition"
import { ModuleDefinition } from "../types/module-definition"
import { toCamelCase } from "../utils/case.util"
import { GenericEntityController } from "./generic-entity.controller"
import { GenericEntityRepository } from "./generic-entity.repository"
import { GenericEntityRoutes } from "./generic-entity.router"
import { GenericEntityService } from "./generic-entity.service"
import { BaseEntity } from "./generic-entity.type"
import { EngineEntityDefinition, EngineEntityDefinitionAdapter } from "./engine-entity-definition"

export class GenericEntityFactory<T extends BaseEntity> {

    readonly moduleDefinition: ModuleDefinition

    private constructor(
        private readonly knex: Knex,
        private readonly entityDefinition: EngineEntityDefinition,
        private readonly path?: string
    ) {
        const repo = new GenericEntityRepository<T>(this.knex, this.entityDefinition)
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

    static fromDecoratedEntity<T extends BaseEntity>(
        knex: Knex,
        entityClass: Function,
        path?: string
    ): GenericEntityFactory<T> {
        const entityDefinition = EngineEntityDefinitionAdapter.fromDecoratedEntity(entityClass)
        return new GenericEntityFactory<T>(knex, entityDefinition, path)
    }

    static fromEngineDefinition<T extends BaseEntity>(
        knex: Knex,
        entityDefinition: EngineEntityDefinition,
        path?: string
    ): GenericEntityFactory<T> {
        return new GenericEntityFactory<T>(knex, entityDefinition, path)
    }

    static fromCanonicalDefinition<T extends BaseEntity>(
        knex: Knex,
        definition: CanonicalSchemaDefinition,
        path?: string
    ): GenericEntityFactory<T> {
        const entityDefinition = EngineEntityDefinitionAdapter.fromCanonicalDefinition(definition)
        return new GenericEntityFactory<T>(knex, entityDefinition, path)
    }
}
