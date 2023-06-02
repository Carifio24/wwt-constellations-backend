#! /usr/bin/env python3

"""
Bootstrap a "handle" with images and scenes based on a WWT WTML file.
"""

import argparse
import time

from requests.exceptions import ConnectionError

from wwt_api_client import constellations as cx
from wwt_data_formats import enums
from wwt_data_formats.folder import Folder
from wwt_data_formats.place import Place


def retry(operation):
    """
    My compute will sometimes fail during large bootstraps due to temporary,
    local network errors. Here's a dumb retry system since the design of the
    openidc_client library that underlies wwt_api_client doesn't allow me to
    activate retries at the request/urllib3 level, as far as I can see.
    """
    for _attempt in range(5):
        try:
            operation()
            return
        except ConnectionError:
            print("(retrying ...)")
            time.sleep(0.5)


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
        "--copyright",
        metavar="TEXT",
        help="The copyright statement to attach to the imported images",
        required=True,
    )
    parser.add_argument(
        "--license-id",
        metavar="SPDX-IDENTIFIER",
        help="The SPDX license identifier to attach to the imported images",
        required=True,
    )
    parser.add_argument(
        "handle",
        metavar="HANDLE",
        help="The handle to create and initialize",
    )
    parser.add_argument(
        "wtml",
        metavar="PATH",
        help="The WTML file to read for data to associate with the handle",
    )

    settings = parser.parse_args()

    # Basic setup

    client = cx.CxClient()

    try:
        f = Folder.from_file(settings.wtml)
    except Exception as e:
        raise Exception(f"error reading WTML file `{settings.wtml}`") from e

    # Create the handle. This is an unadvertised, superuser-only API

    req = {
        "display_name": settings.display_name,
    }

    print(f"Creating handle `{settings.handle}` ...")
    resp = client._send_and_check("/handle/" + settings.handle, json=req).json()
    # nothing useful to do with the response.

    # Register self as owner of the handle. This is another superuser API.

    req = {
        "account_id": settings.my_account_id,
    }

    print(f"Registering self as owner ...")
    resp = client._send_and_check(
        f"/handle/{settings.handle}/add-owner", json=req
    ).json()
    # nothing useful to do with the response.

    # Create the imagesets.

    hc = client.handle_client(settings.handle)
    n_img = 0
    print("Registering images ...")

    for _, _, item in f.immediate_imagesets():
        if item.band_pass != enums.Bandpass.VISIBLE:
            print(
                f"warning: item `{item.name}` has non-default band_pass setting `{item.band_pass}`"
            )
        if item.base_tile_level != 0:
            print(
                f"warning: item `{item.name}` has non-default base_tile_level setting `{item.base_tile_level}`"
            )
        if item.data_set_type != enums.DataSetType.SKY:
            print(
                f"warning: item `{item.name}` has non-default data_set_type setting `{item.data_set_type}`"
            )
        if item.elevation_model != False:
            print(
                f"warning: item `{item.name}` has non-default elevation_model setting `{item.elevation_model}`"
            )
        if item.generic != False:
            print(
                f"warning: item `{item.name}` has non-default generic setting `{item.generic}`"
            )
        if item.sparse != True:
            print(
                f"warning: item `{item.name}` has non-default sparse setting `{item.sparse}`"
            )
        if item.stock_set != False:
            print(
                f"warning: item `{item.name}` has non-default stock_set setting `{item.stock_set}`"
            )

        retry(
            lambda: hc.add_image_from_set(item, settings.copyright, settings.license_id)
        )
        n_img += 1

    print(f"   ... done; {n_img} created")

    # Create the scenes

    n_scene = 0
    print("Registering scenes ...")

    for item in f.children:
        if not isinstance(item, Place):
            continue

        retry(lambda: hc.add_scene_from_place(item))
        n_scene += 1

    print(f"   ... done; {n_scene} created")
    print("All done.")


if __name__ == "__main__":
    main()
