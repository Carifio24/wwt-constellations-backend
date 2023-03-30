#! /usr/bin/env python3

"""
Add images to the database through the API, rather than talking directly to
MongoDB.
"""

import sys

from wwt_api_client import constellations as cx
from wwt_data_formats import enums
from wwt_data_formats.folder import Folder
from wwt_data_formats.imageset import ImageSet


def main():
    client = cx.CxClient()

    handle = sys.argv[1]
    f = Folder.from_file(sys.argv[2])
    hc = client.handle_client(handle)

    for item in f.children:
        if not isinstance(item, ImageSet):
            continue

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

        print(hc.add_image_from_set(item))


if __name__ == "__main__":
    main()
