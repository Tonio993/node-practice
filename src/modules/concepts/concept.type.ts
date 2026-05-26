import { Entity, OneToMany } from "../../shared/generic-entity/generic-entity.decorator"
import { BaseEntity } from "../../shared/generic-entity/generic-entity.type"

@Entity({tableSchema: 'concept_configuration'})
export class Concept implements BaseEntity {
    name!: string

    @OneToMany(() => ConceptField, 'id_concept')
    fields?: ConceptField[]
}

@Entity({tableSchema: 'concept_configuration'})
export class ConceptField implements BaseEntity {
    conceptId!: number
    name!: string
    type!: string
}
