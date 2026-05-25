import { Request, Response } from "express";
import { GenericEntityService } from "./generic-entity.service";
import { BaseEntity } from "./generic-entity.type";

export class GenericEntityController<T extends BaseEntity> {

    constructor(
        private readonly service: GenericEntityService<T>
    ) { }

    findAll = async (req: Request, res: Response): Promise<void> => {
        const result = await this.service.getAll()

        res.json(result)
    }

    findById = async (req: Request, res: Response): Promise<void> => {
        const id = Number(req.params.id)

        const result = await this.service.getById(id)

        result ?
            res.json(result) :
            res.status(404).json({ error: `Entity with id ${id} not found` })
    }

    findByExample = async (req: Request, res: Response): Promise<void> => {
        const example = req.body

        const result = await this.service.getByExample(example)

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
            res.status(404).json({ error: `Entity with id ${id} not found` })
    }

    delete = async (req: Request, res: Response): Promise<void> => {
        const id = Number(req.params.id)

        const deleted = await this.service.delete(id)

        deleted ?
            res.status(200).end() :
            res.status(404).json({ error: `Entity with id ${id} not found` })
    }

}
