import { db } from "../../db/knex";
import { GenericEntityFactory } from "../../shared/generic-entity/generic-entity.factory";
import { ConceptEntity } from './concept.type';

export default new GenericEntityFactory<ConceptEntity>(db, 'concept', 'concept_configuration').moduleDefinition