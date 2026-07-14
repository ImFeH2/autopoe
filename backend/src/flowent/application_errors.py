class ApplicationError(RuntimeError):
    pass


class InvalidRequestError(ApplicationError):
    pass


class ResourceNotFoundError(ApplicationError):
    pass


class OperationConflictError(ApplicationError):
    pass
