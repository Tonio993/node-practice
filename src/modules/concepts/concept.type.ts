import { Entity, OneToMany } from "../../shared/generic-entity/generic-entity.decorator"
import { BaseEntity } from "../../shared/generic-entity/generic-entity.type"

@Entity({tableName: 'concept', tableSchema: 'concept_configuration'})
export class Concept implements BaseEntity {
    id?: number
    name!: string

    @OneToMany('concept_field', 'id_concept')
    fields?: ConceptField[]
}

@Entity({tableName: 'concept_field', tableSchema: 'concept_configuration'})
export class ConceptField implements BaseEntity {
    id?: number
    conceptId!: number
    name!: string
    type!: string
}
