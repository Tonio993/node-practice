import { db } from "../../db/knex";
import { GenericEntityFactory } from "../../shared/generic-entity/generic-entity.factory";
import { Concept } from './concept.type';

export default GenericEntityFactory.fromDecoratedEntity<Concept>(db, Concept).moduleDefinition
