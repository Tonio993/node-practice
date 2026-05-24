import { db } from "../../db/knex";
import { GenericEntityFactory } from "../../shared/generic-entity/generic-entity.factory";
import { Concept } from './concept.type';

export default new GenericEntityFactory<Concept>(db, 'concept', 'concept_configuration', Concept).moduleDefinition
