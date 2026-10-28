from __future__ import annotations

import ctypes
import ctypes.wintypes as wt


class _BLOB(ctypes.Structure):
    _fields_ = [("cbData", wt.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _to_blob(data: bytes) -> tuple[_BLOB, ctypes.Array]:
    buf = ctypes.create_string_buffer(data, len(data))
    return _BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), buf


def dpapi_encrypt(data: bytes) -> bytes:
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    blob, _keep = _to_blob(data)
    out = _BLOB()
    if not crypt32.CryptProtectData(
        ctypes.byref(blob), None, None, None, None, 0, ctypes.byref(out)
    ):
        raise OSError("CryptProtectData failed")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel32.LocalFree(out.pbData)


def dpapi_decrypt(data: bytes) -> bytes:
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    blob, _keep = _to_blob(data)
    out = _BLOB()
    if not crypt32.CryptUnprotectData(
        ctypes.byref(blob), None, None, None, None, 0, ctypes.byref(out)
    ):
        raise OSError("CryptUnprotectData failed")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel32.LocalFree(out.pbData)
