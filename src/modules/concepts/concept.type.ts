import { Column, Entity, ManyToOne, OneToMany } from "../../shared/generic-entity/generic-entity.decorator"
import { BaseEntity } from "../../shared/generic-entity/generic-entity.type"

@Entity({ tableSchema: 'concept_configuration' })
export class Concept implements BaseEntity {
    @Column({ nullable: false, unique: true })
    name!: string

    @Column({ type: 'string', nullable: true })
    tableName?: string

    @Column({ type: 'string', nullable: true })
    tableSchema?: string

    @OneToMany(() => ConceptField, 'id_concept', { mappedBy: 'concept' })
    fields?: ConceptField[]
}

@Entity({ tableSchema: 'concept_configuration' })
export class ConceptField implements BaseEntity {
    @ManyToOne(() => Concept, 'id_concept', { mappedBy: 'fields' })
    concept?: Concept

    @Column({ nullable: false })
    name!: string

    @Column({ nullable: false })
    type!: string

    @Column({ type: 'boolean', nullable: true, defaultValue: true })
    nullable?: boolean

    @Column({ type: 'boolean', nullable: true, defaultValue: false })
    unique?: boolean

    @Column({ type: 'string', nullable: true })
    defaultValue?: string

    @Column({ type: 'boolean', nullable: true, defaultValue: false })
    primaryKey?: boolean

    @Column({ type: 'string', nullable: true })
    columnName?: string

    @Column({ type: 'string', nullable: true })
    label?: string

    @Column({ type: 'string', nullable: true })
    description?: string

    @Column({ type: 'integer', nullable: true })
    position?: number
}

@Entity({ tableSchema: 'concept_configuration' })
export class ConceptRelation implements BaseEntity {
    @ManyToOne(() => Concept, 'id_concept_source')
    sourceConcept?: Concept

    @ManyToOne(() => Concept, 'id_concept_target')
    targetConcept?: Concept

    @Column({ type: 'string', nullable: false })
    relationType!: string

    @Column({ type: 'string', nullable: false })
    foreignKey!: string

    @Column({ type: 'string', nullable: true })
    mappedBy?: string

    @Column({ type: 'string', nullable: true })
    sourceField?: string

    @Column({ type: 'string', nullable: true })
    targetField?: string
}
