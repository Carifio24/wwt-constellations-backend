#! /usr/bin/env python3

"""
Add images to the database through the API, rather than talking directly to
MongoDB.
"""

import sys

from openidc_client import OpenIDCClient
from wwt_data_formats import enums
from wwt_data_formats.folder import Folder
from wwt_data_formats.imageset import ImageSet

APP_IDENTIFIER = "wwt_cx_tool"
MODE = "localhost"
ID_PROVIDER_MAPPING = {
    "Authorization": "/protocol/openid-connect/auth",
    "Token": "/protocol/openid-connect/token",
}
SCOPES = ["profile"]

if MODE == "dev":
    ID_PROVIDER = "https://wwtelescope.dev/auth/realms/constellations"
    CLIENT_ID = "cli-tool"
    API_URL = "https://api.wwtelescope.dev"
elif MODE == "localhost":
    ID_PROVIDER = "http://localhost:8080/realms/constellations"
    CLIENT_ID = "cli-tool"
    API_URL = "http://localhost:7000"


def main():
    client = OpenIDCClient(
        APP_IDENTIFIER,
        ID_PROVIDER,
        ID_PROVIDER_MAPPING,
        CLIENT_ID,
    )

    handle = sys.argv[1]
    f = Folder.from_file(sys.argv[2])

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

        submission = dict(
            wwt=dict(
                base_degrees_per_tile=item.base_degrees_per_tile,
                bottoms_up=item.bottoms_up,
                center_x=item.center_x,
                center_y=item.center_y,
                file_type=item.file_type,
                projection=item.projection.value,
                quad_tree_map=item.quad_tree_map or "",
                rotation=item.rotation_deg,
                tile_levels=item.tile_levels,
                width_factor=item.width_factor,
                thumbnail_url=item.thumbnail_url,
            ),
            storage=dict(legacy_url_template=item.url),
            note=item.name,
        )

        resp = client.send_request(
            f"{API_URL}/handles/{handle}/image",
            scopes=SCOPES,
            new_token=True,
            json=submission,
        )
        resp.raise_for_status()
        print(resp.json())


if __name__ == "__main__":
    main()
