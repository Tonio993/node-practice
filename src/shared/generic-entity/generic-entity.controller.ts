import { Request, Response } from "express";
import { BaseEntity } from "./generic-entity.type";
import { GenericEntityService } from "./generic-entity.service";

export class GenericEntityController<T extends BaseEntity> {

    constructor(
        private readonly service: GenericEntityService<T>
    ) {}

    findById = async (req: Request, res: Response): Promise<void> => {
        const id = Number(req.params.id)

        const result = await this.service.getById(id)
    
        result ?
        res.json(result) :
        res.status(404).json({error: `Entity with id ${id} not found`})
    }

    findAll = async (req: Request, res: Response): Promise<void> => {
        const result = await this.service.getAll()

        res.json(result)
    }

    insert = async (req: Request, res: Response): Promise<void> => {
        const body = req.body

        const result = await this.service.insert(body)

        res.status(201).json(result)
    }

    update = async (req: Request, res: Response): Promise<void> => {
        const id = Number(req.params.id)
        const body = req.body

        const result = await this.service.update(id, body)

        result ?
        res.json(result) :
        res.status(404).json({error: `Entity with id ${id} not found`})
    }

    delete = async (req: Request, res: Response): Promise<void> => {
        const id = Number(req.params.id)

        const result = await this.service.delete(id)

        result ?
        res.json(result) :
        res.status(404).json({error: `Entity with id ${id} not found`})
    }

}
