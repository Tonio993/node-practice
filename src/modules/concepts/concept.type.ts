import { OneToMany } from "../../shared/generic-entity/generic-entity.decorator"
import { BaseEntity } from "../../shared/generic-entity/generic-entity.type"

export class Concept implements BaseEntity {
    id?: number
    name!: string

    @OneToMany('concept_field', 'id_concept')
    fields?: ConceptField[]
}

export class ConceptField implements BaseEntity {
    id?: number
    conceptId!: number
    name!: string
    type!: string
}
