#! /usr/bin/env python3

"""
Add scenes to a Constellations handle based on a WTML file and user-provided
customizations. The data are handled in a way where a large collection of images
can be imported gradually over time.

Before adding any scenes, the handle has to be registered with Constellations.
This can be done with `create_handle.py`.
"""

import argparse
from collections import OrderedDict
import hashlib
import math
import sys
import textwrap
import time

from requests.exceptions import ConnectionError

from wwt_api_client import constellations as cx
from wwt_api_client.constellations.data import SceneContent, SceneImageLayer, ScenePlace
from wwt_api_client.constellations.handles import AddSceneRequest
from wwt_data_formats import enums
from wwt_data_formats.folder import Folder
from wwt_data_formats.place import Place


TODO_ID = object()
H2R = math.pi / 12
D2R = math.pi / 180


def die(text):
    print("fatal error:", text, file=sys.stderr)
    sys.exit(1)


def retry(operation):
    """
    My compute will sometimes fail during large bootstraps due to temporary,
    local network errors. Here's a dumb retry system since the design of the
    openidc_client library that underlies wwt_api_client doesn't allow me to
    activate retries at the request/urllib3 level, as far as I can see.
    """
    for _attempt in range(5):
        try:
            return operation()
        except ConnectionError:
            print("(retrying ...)")
            time.sleep(0.5)


def parse_record_file(stream, path):
    kind = None
    fields = OrderedDict()
    multiline_key = None
    multiline_words = []
    line_num = 0

    for line in stream:
        line_num += 1
        line = line.strip()
        if not line:
            continue

        if kind is None:
            if line.startswith("@"):
                kind = line[1:].split()[0]
            else:
                die(
                    f"expected @ indicator at line {line_num} of `{path}`; got: {line!r}"
                )
        elif line == "---":
            if multiline_key:
                fields[multiline_key] = " ".join(multiline_words)
                multiline_key = None
                multiline_words = []

            yield kind, fields

            kind = None
            fields = OrderedDict()
        else:
            pieces = line.split()

            if pieces[0].endswith(":"):
                if multiline_key:
                    fields[multiline_key] = " ".join(multiline_words)
                    multiline_key = None
                    multiline_words = []

                fields[pieces[0][:-1]] = " ".join(pieces[1:])
            elif pieces[0].endswith(">"):
                if multiline_key:
                    fields[multiline_key] = " ".join(multiline_words)
                    multiline_key = None
                    multiline_words = []

                multiline_key = pieces[0][:-1]
                multiline_words = pieces[1:]
            elif multiline_key:
                multiline_words += pieces
            else:
                die(
                    f"expected : or > indicator at line {line_num} of `{path}`; got: {line!r}"
                )

    if kind or fields or multiline_key:
        die(f"file `{path}` must end with an end-of-record indicator (---)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "handle",
        metavar="HANDLE",
        help="The handle to update",
    )
    settings = parser.parse_args()

    wtml_path = settings.handle + ".wtml"
    todo_path = settings.handle + "_todo.txt"
    done_path = settings.handle + "_done.txt"

    # first things first: load and index the WTML

    imgsets_by_url = {}
    places_by_xmlhash = {}
    xmlhashes_by_url = {}

    try:
        folder = Folder.from_file(wtml_path)
    except FileNotFoundError:
        die(
            f"before running this tool, create a file named `{wtml_path}` with the images/places to be created"
        )
    except Exception as e:
        raise Exception(f"error reading WTML file `{wtml_path}`") from e

    for _idx, _type, imgset in folder.immediate_imagesets():
        imgsets_by_url[imgset.url] = imgset

    for child in folder.children:
        if not isinstance(child, Place):
            continue

        text = child.to_xml_string(indent=False)
        xmlmd5 = hashlib.md5(text.encode("utf8")).hexdigest()
        places_by_xmlhash[xmlmd5] = child

        if child.foreground_image_set is not None:
            xmlhashes_by_url.setdefault(child.foreground_image_set.url, []).append(
                xmlmd5
            )

        if child.image_set is not None:
            xmlhashes_by_url.setdefault(child.image_set.url, []).append(xmlmd5)

    print(
        f"Loaded {len(imgsets_by_url)} WTML imagesets, {len(places_by_xmlhash)} places"
    )

    # scan the "done" file for imagesets and places that have already been
    # handled.

    imgids_by_url = {}
    scnids_by_xmlhash = {}

    try:
        with open(done_path, "rt") as f:
            for kind, fields in parse_record_file(f, done_path):
                if kind == "image":
                    url = fields["url"]
                    cxid = fields["cxid"]
                    imgids_by_url[url] = cxid
                elif kind == "scene":
                    xmlhash = fields["xmlmd5"]
                    cxid = fields["cxid"]
                    scnids_by_xmlhash[xmlhash] = cxid
                else:
                    die(f"unexpected entry kind in `{done_path}`: {kind}")
    except FileNotFoundError:
        pass

    # scan the "todo" file for the same, and buffer its records.

    n_to_register = 0
    todo_records = []

    try:
        with open(todo_path, "rt") as f:
            for kind, fields in parse_record_file(f, todo_path):
                if kind == "image":
                    url = fields["url"]
                    imgids_by_url[url] = TODO_ID

                    if "wip" not in fields:
                        n_to_register += 1
                elif kind == "scene":
                    xmlhash = fields["xmlmd5"]
                    scnids_by_xmlhash[xmlhash] = TODO_ID

                    if "wip" not in fields:
                        n_to_register += 1
                else:
                    die(f"unexpected entry kind in `{todo_path}`: {kind}")

                todo_records.append((kind, fields))
    except FileNotFoundError:
        pass

    print(
        f"Loaded {len(todo_records)} from the to-do file; {n_to_register} ready to register and move"
    )

    # If there is anything to register now, do it. Append those records
    # to the "done" file.

    if n_to_register:
        f_done = open(done_path, "at")
        client = cx.CxClient().handle_client(settings.handle)

        new_todo_records = []

        for kind, fields in todo_records:
            if kind == "image" and "wip" not in fields:
                url = fields["url"]
                id = register_image(client, fields, imgsets_by_url[url])
                fields["cxid"] = id
                imgids_by_url[url] = id
                emit_record(kind, fields, f_done)
            elif kind == "scene" and "wip" not in fields:
                xmlhash = fields["xmlmd5"]
                imgid = imgids_by_url.get(fields["image_url"])
                if imgid is None:
                    raise Exception(
                        f"scene for place {xmlhash} needs undefined image {fields['image_url']}"
                    )
                if imgid is TODO_ID:
                    raise Exception(
                        f"scene for place {xmlhash} needs not-yet-registered image {fields['image_url']}"
                    )
                id = register_scene(client, fields, places_by_xmlhash[xmlhash], imgid)
                fields["cxid"] = id
                scnids_by_xmlhash[xmlhash] = id
                emit_record(kind, fields, f_done)
            else:
                new_todo_records.append((kind, fields))

        f_done.close()
        todo_records = new_todo_records

    # If there are any new images or scenes to stub, do so
    #
    # Here, we jump through some hoops to stub scenes next to their associated
    # images, since in manual editing it is generally way more convenient to
    # have them that way.

    outgoing_urls = {}
    img_descriptions = {}
    n_added = 0

    for imgset in imgsets_by_url.values():
        url = imgset.url

        if url in imgids_by_url:
            # already in "todo" or "done"
            continue

        fields = OrderedDict()
        fields["url"] = url
        fields["copyright"] = "~~COPYRIGHT~~"
        fields["license_id"] = "~~LICENSE~~"
        fields["credits"] = imgset.credits
        fields["wip"] = "yes"
        todo_records.append(("image", fields))
        n_added += 1

        outgoing_urls[url] = imgset.credits_url
        img_descriptions[url] = imgset.description
        imgids_by_url[url] = TODO_ID

        for xmlhash in xmlhashes_by_url[url]:
            if xmlhash in scnids_by_xmlhash:
                # already in "todo" or "done"
                continue

            fields = OrderedDict()
            fields["xmlmd5"] = xmlhash
            fields["image_url"] = url
            fields["outgoing_url"] = outgoing_urls[url]

            place = places_by_xmlhash[xmlhash]
            text = place.description

            if not text:
                text = img_descriptions.get(url)

            if not text:
                text = place.name

            fields["text"] = text
            fields["wip"] = "yes"
            todo_records.append(("scene", fields))
            n_added += 1

            scnids_by_xmlhash[xmlhash] = TODO_ID

    print(f"Adding {n_added} stub records to to-do based on WTML")

    # Finally, rewrite the todo file

    with open(todo_path, "wt") as f:
        for kind, fields in todo_records:
            emit_record(kind, fields, f)


def emit_record(kind, fields, stream):
    print(f"\n@{kind}", file=stream)

    for key, value in fields.items():
        if key in ("text", "credits"):
            print(file=stream)

            for line in textwrap.wrap(
                f"{key}> {value}",
                width=80,
                break_long_words=False,
                break_on_hyphens=False,
            ):
                print(line, file=stream)

            print(file=stream)
        else:
            print(f"{key}: {value}", file=stream)

    print("---", file=stream)


def register_image(client, fields, imgset):
    if imgset.band_pass != enums.Bandpass.VISIBLE:
        print(
            f"warning: imageset `{imgset.name}` has non-default band_pass setting `{imgset.band_pass}`"
        )
    if imgset.base_tile_level != 0:
        print(
            f"warning: imageset `{imgset.name}` has non-default base_tile_level setting `{imgset.base_tile_level}`"
        )
    if imgset.data_set_type != enums.DataSetType.SKY:
        print(
            f"warning: imageset `{imgset.name}` has non-default data_set_type setting `{imgset.data_set_type}`"
        )
    if imgset.elevation_model != False:
        print(
            f"warning: imageset `{imgset.name}` has non-default elevation_model setting `{imgset.elevation_model}`"
        )
    if imgset.generic != False:
        print(
            f"warning: imageset `{imgset.name}` has non-default generic setting `{imgset.generic}`"
        )
    if imgset.sparse != True:
        print(
            f"warning: imageset `{imgset.name}` has non-default sparse setting `{imgset.sparse}`"
        )
    if imgset.stock_set != False:
        print(
            f"warning: imageset `{imgset.name}` has non-default stock_set setting `{imgset.stock_set}`"
        )

    credits = fields["credits"]
    copyright = fields["copyright"]
    license_id = fields["license_id"]

    print("registering image:", imgset.url)
    return retry(
        lambda: client.add_image_from_set(
            imgset, copyright, license_id, credits=credits
        )
    )


def register_scene(client, fields, place, imgid):
    image_layers = [SceneImageLayer(image_id=imgid, opacity=1.0)]

    api_place = ScenePlace(
        ra_rad=place.ra_hr * H2R,
        dec_rad=place.dec_deg * D2R,
        roll_rad=place.rotation_deg * D2R,
        roi_height_deg=place.zoom_level / 6,
        roi_aspect_ratio=1.0,
    )

    content = SceneContent(image_layers=image_layers)

    req = AddSceneRequest(
        place=api_place,
        content=content,
        text=fields["text"],
        outgoing_url=fields["outgoing_url"],
    )

    print("registering scene:", fields["xmlmd5"])
    return retry(lambda: client.add_scene(req))


if __name__ == "__main__":
    main()
