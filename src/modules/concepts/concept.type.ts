import { Entity, ManyToOne, OneToMany } from "../../shared/generic-entity/generic-entity.decorator"
import { BaseEntity } from "../../shared/generic-entity/generic-entity.type"

@Entity({ tableSchema: 'concept_configuration' })
export class Concept implements BaseEntity {
    name!: string
    tableName?: string
    tableSchema?: string

    @OneToMany(() => ConceptField, 'id_concept', { mappedBy: 'concept' })
    fields?: ConceptField[]
}

@Entity({ tableSchema: 'concept_configuration' })
export class ConceptField implements BaseEntity {
    @ManyToOne(() => Concept, 'id_concept', { mappedBy: 'fields' })
    concept?: Concept

    name!: string
    type!: string
    nullable?: boolean
    unique?: boolean
    defaultValue?: string
    primaryKey?: boolean
    columnName?: string
    label?: string
    description?: string
    position?: number
}

@Entity({ tableSchema: 'concept_configuration' })
export class ConceptRelation implements BaseEntity {
    @ManyToOne(() => Concept, 'id_concept_source')
    sourceConcept?: Concept

    @ManyToOne(() => Concept, 'id_concept_target')
    targetConcept?: Concept

    relationType!: string
    foreignKey!: string
    mappedBy?: string
    sourceField?: string
    targetField?: string
}
