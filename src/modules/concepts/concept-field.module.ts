import { db } from "../../db/knex";
import { GenericEntityFactory } from "../../shared/generic-entity/generic-entity.factory";
import { ConceptField } from './concept.type';

export default new GenericEntityFactory<ConceptField>(db, 'concept_field', 'concept_configuration', ConceptField).moduleDefinition
