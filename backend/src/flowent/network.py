from flowent._version import __version__


def flowent_user_agent() -> str:
    return f"Flowent/{__version__}"
