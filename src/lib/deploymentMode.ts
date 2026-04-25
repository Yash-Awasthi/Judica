export type DeploymentMode = 'lite' | 'standard' | 'enterprise'

export const DEPLOYMENT_MODE: DeploymentMode =
  (process.env.DEPLOYMENT_MODE as DeploymentMode) ||
  (process.env.LITE_MODE === 'true' ? 'lite' : 'standard')

export const isLiteMode = () => DEPLOYMENT_MODE === 'lite'
export const isEnterprise = () => DEPLOYMENT_MODE === 'enterprise'

// Feature availability by mode
export const features = {
  vespaSearch: !isLiteMode(),
  backgroundSync: !isLiteMode(),
  vectorSharding: !isLiteMode(),
  nlpPipeline: !isLiteMode(),
  multiTenancy: DEPLOYMENT_MODE !== 'lite',
  scim: DEPLOYMENT_MODE === 'enterprise',
  ragBenchmark: DEPLOYMENT_MODE === 'enterprise',
}
