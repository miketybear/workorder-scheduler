"""Loopback development server with the Windows event loop required by psycopg."""

import asyncio

import uvicorn


def main() -> None:
    config = uvicorn.Config(
        "app.main:create_app",
        factory=True,
        host="127.0.0.1",
        port=8000,
        access_log=False,
    )
    # psycopg async connections do not support Windows' default ProactorEventLoop.
    with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
        runner.run(uvicorn.Server(config).serve())


if __name__ == "__main__":
    main()
