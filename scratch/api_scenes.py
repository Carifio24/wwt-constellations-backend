#! /usr/bin/env python3

"""
Add scenes to the database through the API.
"""

import sys

from wwt_api_client import constellations as cx
from wwt_data_formats.folder import Folder
from wwt_data_formats.place import Place


def main():
    client = cx.CxClient()

    handle = sys.argv[1]
    f = Folder.from_file(sys.argv[2])
    hc = client.handle_client(handle)

    for item in f.children:
        if not isinstance(item, Place):
            continue

        print(hc.add_scene_from_place(item))


if __name__ == "__main__":
    main()
