import { authController } from "./auth.controller";
import { frontendController } from "./frontend.controller";
import { meController } from "./me.controller";
import { swaggerController } from "./swagger.controller";

export function controllers() {
  authController();
  meController();
  // Make sure this is the last because it needs the registered routes
  swaggerController();
  // After swagger, so the page routes stay out of the API document.
  frontendController();
}
