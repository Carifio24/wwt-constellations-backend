#! /usr/bin/env python3

"""
Create a Constellations "handle". No images or scenes are added.

This is done with two undocumented "superuser" APIs.
"""

import argparse

from wwt_api_client import constellations as cx


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--display-name",
        metavar="TEXT",
        help="The display name of the handle",
        required=True,
    )
    parser.add_argument(
        "--my-account-id",
        metavar="UUID",
        help="The account ID of your account",
        required=True,
    )
    parser.add_argument(
        "handle",
        metavar="HANDLE",
        help="The handle to create and initialize",
    )

    settings = parser.parse_args()
    client = cx.CxClient()

    req = {
        "display_name": settings.display_name,
    }
    print(f"Creating handle `{settings.handle}` ...")
    client._send_and_check("/handle/" + settings.handle, json=req).json()

    req = {
        "account_id": settings.my_account_id,
    }
    print(f"Registering self as owner ...")
    client._send_and_check(f"/handle/{settings.handle}/add-owner", json=req).json()


if __name__ == "__main__":
    main()
