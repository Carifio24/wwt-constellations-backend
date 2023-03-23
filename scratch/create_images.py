from json import dump
from re import compile
from pymongo import MongoClient
from xml.etree import ElementTree as ET

pattern = compile(r"(?<!^)(?=[A-Z])")


def pascal_to_snake(s):
    return pattern.sub("_", s).lower()


tree = ET.parse("astrophoto.wtml")
root = tree.getroot()

imagesets = []
folders = [child for child in root if child.tag == "Folder"]
places = [child for folder in folders for child in folder if child.tag == "Place"]
fg_isets = [
    child for place in places for child in place if child.tag == "ForegroundImageSet"
]
for fg in fg_isets:
    iset = fg.find("ImageSet")
    if iset is None:
        continue
    output = {"imageset": iset.attrib}
    for tag in ["ThumbnailUrl", "Credits", "CreditsUrl"]:
        item = iset.find(tag)
        if item is not None:
            output[pascal_to_snake(tag)] = item.text
    imagesets.append(output)

with open("testing_images.json", "w") as f:
    dump(imagesets, f, sort_keys=True, indent=2)

uri = "mongodb://127.0.0.1:27017"
client = MongoClient(uri)
database = client["constellations-db"]
collection = database["images"]
collection.insert_many(imagesets)
