import { Entity, ManyToOne, OneToMany } from "../../shared/generic-entity/generic-entity.decorator"
import { BaseEntity } from "../../shared/generic-entity/generic-entity.type"

@Entity({tableSchema: 'concept_configuration'})
export class Concept implements BaseEntity {
    name!: string

    @OneToMany(() => ConceptField, 'id_concept', { mappedBy: 'concept' })
    fields?: ConceptField[]
}

@Entity({tableSchema: 'concept_configuration'})
export class ConceptField implements BaseEntity {

    @ManyToOne(() => Concept, 'id_concept', { mappedBy: 'fields' })
    concept?: Concept

    name!: string
    type!: string
}
