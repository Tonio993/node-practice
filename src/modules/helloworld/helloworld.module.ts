import { Request, Response, Router } from "express"
import { ModuleDefinition } from "../../shared/types/module-definition"

const router = Router()

router.get('/hello', (req: Request, res: Response) => {
    res.json({
        message: 'Hello, world!'
    })
})

const moduleDefinition: ModuleDefinition = {
    route: {
        path: '/',
        router
    }
}

export default moduleDefinition
