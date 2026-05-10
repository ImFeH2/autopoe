from fastapi import APIRouter

from flowent.routes.access import router as access_router
from flowent.routes.assistant import router as assistant_router
from flowent.routes.image_assets import router as image_assets_router
from flowent.routes.meta import router as meta_router
from flowent.routes.nodes import router as nodes_router
from flowent.routes.prompts import router as prompts_router
from flowent.routes.providers_route import router as providers_router
from flowent.routes.roles import router as roles_router
from flowent.routes.settings import router as settings_router
from flowent.routes.tabs import router as tabs_router
from flowent.routes.ws import router as ws_router

router = APIRouter()
router.include_router(access_router)
router.include_router(nodes_router)
router.include_router(assistant_router)
router.include_router(image_assets_router)
router.include_router(roles_router)
router.include_router(providers_router)
router.include_router(prompts_router)
router.include_router(settings_router)
router.include_router(tabs_router)
router.include_router(meta_router)
router.include_router(ws_router)
