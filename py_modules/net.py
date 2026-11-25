"""HTTPS for the plugin's few requests.

Decky's bundled Python does not find the system's CA certificates on its own,
so every request verifies against the distribution's CA bundle.
"""
from __future__ import annotations

import functools
import os
import ssl
import urllib.request

# Arch/SteamOS, Debian/Ubuntu, Fedora/Bazzite, openSUSE.
CA_BUNDLES = (
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/ca-bundle.pem",
)


@functools.cache
def ssl_context() -> ssl.SSLContext:
    context = ssl.create_default_context()
    for path in CA_BUNDLES:
        if os.path.isfile(path):
            context.load_verify_locations(cafile=path)
            break
    return context


def open_url(request: urllib.request.Request, timeout: float):
    return urllib.request.urlopen(request, timeout=timeout, context=ssl_context())
