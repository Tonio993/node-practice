import { db } from "../../db/knex";
import { GenericEntityFactory } from "../../shared/generic-entity/generic-entity.factory";
import { ConceptField } from './concept.type';

export default GenericEntityFactory.fromDecoratedEntity<ConceptField>(db, ConceptField).moduleDefinition
