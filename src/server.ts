import  express, { Request, Response } from 'express'
import fg from 'fast-glob'
import path from 'path'
import { pathToFileURL } from 'url';
 
const app = express();
const PORT = 3000;

app.use(express.json())

async function loadModules() {
  const isProduction = process.env.NODE_ENV === 'production'
  const pattern = isProduction ? 'dist/modules/**/*.module.js' : 'src/modules/**/*.module.ts'

  const root = process.cwd()
  const files = await fg(pattern)
  
  for (const file of files) {
    const filePath = path.join(root, file)

    const moduleImport = await import(
      pathToFileURL(filePath).href
    )

    const module = moduleImport.default

    if (module.route) {
      app.use(`/api${module.route.path}`, module.route.router)
      console.log(`Loaded module: ${module.route.path}`)
    }
  }
}

async function bootstrap() {
  await loadModules()

  app.listen(PORT, () => {
    console.log('Server started')
  })
}

bootstrap()
