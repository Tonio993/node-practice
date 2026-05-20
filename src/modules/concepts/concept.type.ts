export interface ConceptEntity {
    id: number
    name: string
}

export interface ConceptFieldEntity {
    id: number
    idConcept: number
    name: string
    type: string
}

export interface Concept {
    id: number
    name: string
    fields: [{
        id: number
        idConcept: number
        name: string
        type: string
    }]
}